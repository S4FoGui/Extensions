// ============================================================
// Leitor IA — painel lateral (UI minimalista preto & branco)
// ============================================================
"use strict";

const $ = (s) => document.querySelector(s);

// Ícones minimalistas por provedor (monocromáticos)
const P_ICONS = {
  openai:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3L12 2.6Z"/><circle cx="12" cy="12" r="3.1"/></svg>',
  anthropic:
    '<svg viewBox="0 0 24 24" width="14" height="14"><g stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="4.2" y1="7.5" x2="19.8" y2="16.5"/><line x1="4.2" y1="16.5" x2="19.8" y2="7.5"/></g></svg>',
  google:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2c.9 5.2 4.8 9.1 10 10-5.2.9-9.1 4.8-10 10-.9-5.2-4.8-9.1-10-10 5.2-.9 9.1-4.8 10-10Z"/></svg>',
  kimi: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  zai: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M13.2 2 4.6 13.4h6L9.4 22l9.4-12.2h-6L13.2 2Z"/></svg>'
};

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>';

function providerIcon(id) {
  return P_ICONS[id] || "";
}

// ---------- estado ----------
let keys = { openai: "", anthropic: "", google: "", kimi: "", zai: "" };
let baseUrls = {};
let customModels = [];
let prefs = {
  model: "anthropic:claude-sonnet-5",
  effort: "medium",
  includePage: true,
  includeVision: false, // envia print (JPEG/base64) da página p/ modelos com visão
  charLimit: 20000,
  panelMode: "inpage", // inpage | sidepanel | right | left
  oauthMode: {} // { [provider]: "web" | "key" | "oauth" }
};
let oauth = {}; // { clientIds: {google: "..."}, tokens: {google: {accessToken, expiresAt}} }
let page = null; // { url, title, description, text, selection }
let pageError = null;
let messages = []; // { role: "user"|"assistant", content }
let sending = false;
let port = null;
let webHolder = null; // bolha da resposta vinda da aba oculta do site
let webAcc = "";
let currentReqId = null; // roteamento idempotente dos streams
let keepAlivePort = null; // segura o SW vivo durante o streaming

function newReqId() {
  return "req-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
function openKeepAlive() {
  try {
    if (!keepAlivePort) keepAlivePort = chrome.runtime.connect({ name: "keepalive" });
  } catch (_) {}
}
function closeKeepAlive() {
  try {
    if (keepAlivePort) keepAlivePort.disconnect();
  } catch (_) {}
  keepAlivePort = null;
}
function clearWebSession() {
  currentReqId = null;
  closeKeepAlive();
  try {
    sessionStorage.removeItem("leitor-ia-webreq");
  } catch (_) {}
}

// Stream unificado da web grátis (delta/done) — idempotente por reqId:
// deltas de requisições antigas são ignorados; se o painel recarregar no
// meio de um stream, o boot retoma via web-resume + snapshot do content.
chrome.runtime.onMessage.addListener((m) => {
  if (!m) return;
  if (currentReqId && m.reqId && m.reqId !== currentReqId) return;
  if (m.type === "leitor-ia-web-delta" && sending && webHolder) {
    webAcc = m.text || webAcc;
    streamInto(webHolder, webAcc);
  } else if (m.type === "leitor-ia-web-done" && sending && webHolder) {
    finishStream(webHolder, m.text || webAcc, m.error || null, false);
    setSending(false);
    webHolder = null;
    clearWebSession();
  }
});
let rafPending = false;

const SUGGESTIONS = [
  "Resuma esta página em 5 pontos",
  "Explique como se eu tivesse 12 anos",
  "Quais são os dados e números mais importantes?",
  "Sugira 3 perguntas para eu fazer sobre este texto"
];

// ---------- inicialização ----------
document.addEventListener("DOMContentLoaded", async () => {
  bindUI();
  const stored = await chrome.storage.local.get([
    "keys",
    "baseUrls",
    "customModels",
    "prefs",
    "chat",
    "oauth"
  ]);
  keys = Object.assign(keys, stored.keys || {});
  oauth = stored.oauth || {};
  baseUrls = stored.baseUrls || {};
  customModels = stored.customModels || [];
  prefs = Object.assign(prefs, stored.prefs || {});
  messages =
    stored.chat && Array.isArray(stored.chat.messages) ? stored.chat.messages : [];

  buildModelMenu();
  syncModelUI();
  buildSettingsForm();
  syncEffortUI();
  syncVisionUI();
  renderChat();
  await capturePage();
  await handlePendingSelection();
  // Resume de stream web após reload do painel (snapshot do content script)
  (async () => {
    let rid = null;
    try {
      rid = sessionStorage.getItem("leitor-ia-webreq");
    } catch (_) {}
    if (!rid) return;
    let r = null;
    try {
      r = await chrome.runtime.sendMessage({ type: "web-resume" });
    } catch (_) {}
    if (r && r.ok && r.snapshot && !r.snapshot.done && r.snapshot.reqId === rid) {
      currentReqId = rid;
      openKeepAlive();
      webHolder = addAssistantPlaceholder();
      webAcc = r.snapshot.text || "";
      if (webAcc) streamInto(webHolder, webAcc);
      setSending(true);
    } else {
      try {
        sessionStorage.removeItem("leitor-ia-webreq");
      } catch (_) {}
    }
  })();
  $("#input").focus();
  // Se a extensão for recarregada com o painel aberto, o contexto morre —
  // reativa sozinho (recarrega só o iframe); se não voltar, avisa.
  setInterval(() => {
    if (!extAlive()) reativar();
  }, 10000);
});

// Recarrega só o iframe do painel para reconectar com a extensão.
// Máximo 1 tentativa a cada 30s; se ainda assim estiver morto
// (extensão desativada), mostra o aviso manual.
function reativar() {
  try {
    const last = Number(sessionStorage.getItem("leitor-ia-reativar") || 0);
    if (Date.now() - last > 30000) {
      sessionStorage.setItem("leitor-ia-reativar", String(Date.now()));
      location.reload();
      return;
    }
  } catch (_) {}
  deadBanner();
}

// O id some quando o contexto da extensão foi invalidado (reload da extensão
// com a página aberta). Recarregar só o iframe do painel já reconecta.
function extAlive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

function deadBanner() {
  showBanner(
    "A extensão foi atualizada/recarregada e este painel perdeu a conexão com ela.",
    "Reativar painel",
    () => location.reload()
  );
}

function bindUI() {
  $("#btn-send").addEventListener("click", () => {
    if (sending) {
      try {
        if (port) port.postMessage({ type: "stop" });
      } catch (_) {}
    } else {
      sendMessage();
    }
  });

  const input = $("#input");
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending) sendMessage();
    }
  });

  // ----- seletor de modelo customizado -----
  const trigger = $("#msel-trigger");
  trigger.addEventListener("click", () => {
    const msel = $("#msel");
    if (msel.classList.contains("open")) closeModelMenu();
    else openModelMenu();
  });
  trigger.addEventListener("keydown", (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !$("#msel").classList.contains("open")) {
      e.preventDefault();
      openModelMenu();
    }
  });
  $("#msel-menu").addEventListener("keydown", menuKeydown);
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#msel")) closeModelMenu();
  });

  $("#effort").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-effort]");
    if (!btn) return;
    prefs.effort = btn.dataset.effort;
    syncEffortUI();
    persist();
  });

  $("#btn-new").addEventListener("click", () => {
    if (!extAlive()) {
      reativar();
      return;
    }
    try {
      if (sending && port) port.postMessage({ type: "stop" });
    } catch (_) {}
    // reset completo: histórico, stream em curso e estado de envio
    sending = false;
    webHolder = null;
    webAcc = "";
    clearWebSession();
    setSending(false);
    messages = [];
    hideBanner();
    renderChat(); // mantém o chip da página; limpa só o feed
    persist();
    capturePage();
    // modo web: aba oculta volta p/ URL limpa do provedor
    try {
      chrome.runtime.sendMessage({ type: "web-reset" }).catch(() => {});
    } catch (_) {}
  });

  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-vision").addEventListener("click", () => {
    prefs.includeVision = !prefs.includeVision;
    syncVisionUI();
    persist();
    if (prefs.includeVision) {
      const { provider } = parseModel(prefs.model);
      if (((prefs.oauthMode || {})[provider] || "web") === "web") {
        showBanner(
          "Visão anexa o print nos modos Chave de API/OAuth. No modo Web o site do modelo não recebe imagem da extensão.",
          null
        );
      }
    }
  });
  $("#settings-close").addEventListener("click", closeSettings);
  $("#settings-save").addEventListener("click", saveSettings);
  $("#settings-overlay").addEventListener("click", (e) => {
    if (e.target.id === "settings-overlay") closeSettings();
  });

  $("#page-refresh").addEventListener("click", capturePage);
  $("#page-retry").addEventListener("click", () => {
    if (!extAlive()) {
      reativar();
      return;
    }
    capturePage();
  });
  $("#page-toggle").addEventListener("click", () => {
    prefs.includePage = !prefs.includePage;
    syncPageChip();
    persist();
  });

  $("#custom-add").addEventListener("click", addCustomModel);
}

// ---------- OAuth por provedor (todos que oferecem) ----------
// ---------- um cartão por provedor: acesso + chave + endpoint + OAuth ----------
function renderProviderCards() {
  const wrap = $("#providers-list");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const p of PROVIDERS) {
    const hasOauth = !!p.oauth;
    const card = document.createElement("div");
    card.className = "prov-card";
    card.innerHTML =
      '<div class="key-head"><span class="key-name"><span class="kn-icon">' +
      providerIcon(p.id) +
      "</span>" +
      p.name +
      "</span>" +
      '<span class="prov-links"><a href="' +
      p.consoleUrl +
      '" target="_blank" rel="noopener noreferrer">obter chave ↗</a>' +
      (hasOauth ? '<span class="oauth-status" data-status="' + p.id + '"></span>' : "") +
      "</span></div>" +
      '<label class="limit-row">Acesso<select data-oauth-mode="' +
      p.id +
      '"><option value="web">Web grátis (sem chave, resposta no painel)</option><option value="key">Chave de API</option>' +
      (hasOauth ? '<option value="oauth">Conta Google (OAuth, grátis)</option>' : "") +
      "</select></label>" +
      '<div data-fields="key">' +
      '<div class="key-input"><input type="password" data-key="' +
      p.id +
      '" placeholder="' +
      p.keyPlaceholder +
      '" autocomplete="off" spellcheck="false">' +
      '<button class="eye" title="Mostrar/ocultar chave">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>' +
      "</button></div>" +
      '<input type="text" class="base-input" data-base="' +
      p.id +
      '" placeholder="Endpoint próprio (opcional): ' +
      p.baseUrl +
      '" spellcheck="false">' +
      "</div>" +
      (hasOauth
        ? '<div data-fields="oauth">' +
          '<input type="text" class="base-input" data-client-id="' +
          p.id +
          '" placeholder="Client ID OAuth" spellcheck="false">' +
          '<div class="oauth-actions"><button class="btn" data-oauth-connect="' +
          p.id +
          '">Conectar conta</button></div></div>'
        : "");

    const sel = card.querySelector("[data-oauth-mode]");
    sel.value = (prefs.oauthMode || {})[p.id] || "web";
    const sync = () => {
      const m = sel.value;
      card.querySelector('[data-fields="key"]').style.display = m === "key" ? "" : "none";
      const oa = card.querySelector('[data-fields="oauth"]');
      if (oa) oa.style.display = m === "oauth" ? "" : "none";
    };
    sel.addEventListener("change", () => {
      prefs.oauthMode = Object.assign({}, prefs.oauthMode, { [p.id]: sel.value });
      persist();
      sync();
    });

    const keyInp = card.querySelector("input[data-key]");
    keyInp.value = keys[p.id] || "";
    keyInp.addEventListener("input", () => {
      keys[p.id] = keyInp.value.trim();
      persist();
    });
    card.querySelector(".eye").addEventListener("click", () => {
      keyInp.type = keyInp.type === "password" ? "text" : "password";
    });
    const baseInp = card.querySelector("[data-base]");
    baseInp.value = baseUrls[p.id] || "";
    baseInp.addEventListener("input", () => {
      const v = baseInp.value.trim();
      if (v) baseUrls[p.id] = v;
      else delete baseUrls[p.id];
      persist();
    });

    if (hasOauth) {
      const ci = card.querySelector("[data-client-id]");
      ci.value = (oauth.clientIds || {})[p.id] || "";
      ci.addEventListener("input", () => {
        oauth.clientIds = Object.assign({}, oauth.clientIds, { [p.id]: ci.value.trim() });
        persist();
      });
      card
        .querySelector("[data-oauth-connect]")
        .addEventListener("click", () => connectProvider(p.id));
      updateOAuthStatus(p.id, card);
    }
    sync();
    wrap.appendChild(card);
  }
}

async function connectProvider(providerId) {
  const res = await chrome.runtime.sendMessage({ type: "oauth", provider: providerId });
  const stored = await chrome.storage.local.get("oauth");
  oauth = stored.oauth || {};
  updateOAuthStatus(providerId);
  if (res && !res.ok) showBanner(res.error || "Falha no OAuth.", "Abrir ajustes", openSettings);
}

function updateOAuthStatus(providerId, scope) {
  const el = (scope || document).querySelector('[data-status="' + providerId + '"]');
  if (!el) return;
  const t = (oauth.tokens || {})[providerId];
  if (t && t.accessToken && Date.now() < (t.expiresAt || 0)) {
    el.textContent = "conectado (~" + Math.max(1, Math.round((t.expiresAt - Date.now()) / 60000)) + " min)";
    el.classList.add("on");
  } else {
    el.textContent = "não conectado";
    el.classList.remove("on");
  }
}

// ---------- seletor de modelo customizado ----------
function modelValue(providerId, modelId) {
  return providerId + ":" + modelId;
}

function modelEntries() {
  const groups = [];
  for (const p of PROVIDERS) {
    const items = p.models.map((m) => Object.assign({ provider: p.id }, m));
    for (const c of customModels.filter((c) => c.provider === p.id)) {
      items.push({ provider: p.id, id: c.id, label: c.id, effort: true, custom: true });
    }
    groups.push({ provider: p, items: items });
  }
  return groups;
}

function buildModelMenu() {
  const menu = $("#msel-menu");
  menu.innerHTML = "";
  for (const g of modelEntries()) {
    const label = document.createElement("span");
    label.className = "msel-group-label";
    label.textContent = g.provider.name;
    menu.appendChild(label);
    for (const m of g.items) {
      const btn = document.createElement("button");
      btn.className = "msel-item";
      btn.dataset.value = modelValue(g.provider.id, m.id);
      btn.setAttribute("role", "option");
      btn.title = m.label + (m.custom ? " (personalizado)" : "");
      btn.innerHTML =
        '<span class="p-icon">' + providerIcon(g.provider.id) + "</span>" +
        '<span class="msel-item-label">' +
        escapeHtml(m.label) +
        (m.custom ? ' <span class="star">★</span>' : "") +
        "</span>" +
        '<span class="check">' + CHECK_SVG + "</span>";
      btn.addEventListener("click", () => {
        prefs.model = btn.dataset.value;
        closeModelMenu();
        syncModelUI();
        syncEffortUI();
        persist();
        $("#input").focus();
        
        // Se escolheu modo Web e clicou num modelo, avisa que modo web
        // não tem poder pra trocar o modelo lá no site (Gemini, ChatGPT etc).
        const mode = (prefs.oauthMode || {})[g.provider.id] || "web";
        if (mode === "web" && !m.custom) {
          showBanner(
            "No modo Web, o " + g.provider.name + " usará o modelo que estiver selecionado lá na página dele (a escolha aqui vale p/ chave API).",
            null
          );
        }
      });
      menu.appendChild(btn);
    }
  }
  syncModelUI();
}

function syncModelUI() {
  // se o modelo salvo não existir mais no menu, volta para o primeiro
  const sel = '.msel-item[data-value="' + prefs.model.replace(/"/g, '\\"') + '"]';
  if (!document.querySelector(sel)) {
    const first = document.querySelector(".msel-item");
    if (first) prefs.model = first.dataset.value;
  }
  const meta = getModelMeta();
  $("#msel-label").textContent = meta.label;
  $("#msel-label").title = meta.label;
  $("#msel-icon").innerHTML = providerIcon(meta.provider);
  document.querySelectorAll(".msel-item").forEach((el) => {
    const active = el.dataset.value === prefs.model;
    el.classList.toggle("active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function openModelMenu() {
  const msel = $("#msel");
  msel.classList.add("open");
  $("#msel-trigger").setAttribute("aria-expanded", "true");
  const menu = $("#msel-menu");
  menu.focus({ preventScroll: true });
  const act = menu.querySelector(".msel-item.active");
  if (act) {
    act.classList.add("focused");
    act.scrollIntoView({ block: "nearest" });
  }
}

function closeModelMenu() {
  const msel = $("#msel");
  if (!msel.classList.contains("open")) return;
  msel.classList.remove("open");
  $("#msel-trigger").setAttribute("aria-expanded", "false");
  $("#msel-menu")
    .querySelectorAll(".focused")
    .forEach((i) => i.classList.remove("focused"));
}

function menuKeydown(e) {
  const items = Array.from($("#msel-menu").querySelectorAll(".msel-item"));
  if (!items.length) return;
  let idx = items.findIndex((i) => i.classList.contains("focused"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (idx < 0) idx = items.findIndex((i) => i.classList.contains("active"));
    idx =
      e.key === "ArrowDown"
        ? Math.min(items.length - 1, idx + 1)
        : Math.max(0, idx < 0 ? 0 : idx - 1);
    items.forEach((i) => i.classList.remove("focused"));
    items[idx].classList.add("focused");
    items[idx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    (idx >= 0 ? items[idx] : items[0]).click();
  } else if (e.key === "Escape") {
    closeModelMenu();
    $("#msel-trigger").focus();
  } else if (e.key === "Tab") {
    closeModelMenu();
  }
}

// ---------- modelo / esforço ----------
function parseModel(value) {
  const i = value.indexOf(":");
  return { provider: value.slice(0, i), model: value.slice(i + 1) };
}

// Prioridade de endpoint: modelo customizado > override do provedor > padrão.
function resolveBaseUrl(providerId) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  const { model } = parseModel(prefs.model);
  const c = customModels.find((x) => x.provider === providerId && x.id === model);
  return (c && c.baseUrl) || baseUrls[providerId] || (p && p.baseUrl) || "";
}

function getModelMeta() {
  const { provider, model } = parseModel(prefs.model);
  const p = PROVIDERS.find((x) => x.id === provider);
  const m = p && p.models.find((x) => x.id === model);
  if (m) return Object.assign({ provider }, m);
  if (customModels.some((c) => c.provider === provider && c.id === model)) {
    return { provider: provider, id: model, label: model, effort: true };
  }
  return { provider: provider, id: model, label: model, effort: false };
}

function syncEffortUI() {
  const meta = getModelMeta();
  const p = PROVIDERS.find((x) => x.id === meta.provider);
  const seg = $("#effort");
  seg.classList.toggle("disabled", !meta.effort);
  seg.title = p ? p.effortHint : "Esforço de raciocínio";
  seg.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.effort === prefs.effort);
  });
}

async function captureThumb() {
  const box = $("#vision-thumb");
  if (!box) return "";
  try {
    const shot = await chrome.runtime.sendMessage({ type: "get-screenshot" });
    if (shot && shot.ok && /^data:image\//.test(shot.dataUrl || "")) {
      const img = box.querySelector("img");
      if (img) img.src = shot.dataUrl;
      box.classList.remove("hidden");
      return shot.dataUrl;
    }
    if (shot && !shot.ok) {
      console.warn("[Leitor IA] captureThumb falhou:", shot.error);
    }
  } catch (e) {
    console.warn("[Leitor IA] captureThumb erro:", e);
  }
  box.classList.add("hidden");
  return "";
}

function syncVisionUI() {
  const b = $("#btn-vision");
  if (!b) return;
  b.classList.toggle("on", !!prefs.includeVision);
  b.title = prefs.includeVision
    ? "Visão ATIVA: o print da página vai junto com a pergunta"
    : "Visão: enviar print da página junto (modelos compatíveis)";
  if (prefs.includeVision) captureThumb();
  else {
    const box = $("#vision-thumb");
    if (box) box.classList.add("hidden");
  }
}

// ---------- leitura da página ----------
async function capturePage() {
  page = null;
  pageError = null;
  if (!extAlive()) {
    pageError = "Extensão recarregada — reativando painel…";
    reativar();
    syncPageChip();
    return;
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: "get-context" });
    if (res && res.ok) page = res;
    else pageError = (res && res.error) || "Não consegui ler a página.";
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/invalidated|disconnected|receiving end does not exist/i.test(msg) || !extAlive()) {
      pageError = "Extensão recarregada — reativando painel…";
      reativar();
    } else {
      pageError = msg;
    }
  }
  syncPageChip();
}

function syncPageChip() {
  const chip = $("#page-chip");
  const missing = $("#page-missing");
  if (!page) {
    chip.classList.add("hidden");
    missing.classList.remove("hidden");
    $("#page-missing-label").textContent = pageError || "Página não lida";
    $("#page-missing-label").title = pageError || "";
    return;
  }
  missing.classList.add("hidden");
  chip.classList.remove("hidden");
  chip.classList.toggle("dimmed", !prefs.includePage);
  $("#page-title").textContent = page.title || page.url;
  const btn = $("#page-toggle");
  btn.title = prefs.includePage
    ? "Não incluir a página no contexto"
    : "Voltar a incluir a página no contexto";
  btn.innerHTML = prefs.includePage
    ? '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
}

async function handlePendingSelection() {
  const s = await chrome.storage.session.get("pendingSelection");
  if (s.pendingSelection) {
    await chrome.storage.session.remove("pendingSelection");
    const input = $("#input");
    input.value = "Explique o trecho que selecionei na página.";
    autosize();
    input.focus();
  }
}

function buildSystemPrompt() {
  let sys =
    "Você é o Leitor IA, um assistente que ajuda o usuário a entender e aproveitar " +
    "a página que ele está vendo no navegador. Responda sempre em português do Brasil, " +
    "de forma clara e bem estruturada (use markdown leve quando ajudar). Seja direto.";
  if (prefs.includePage && page) {
    const limit = prefs.charLimit || 20000;
    const text = (page.text || "").slice(0, limit);
    sys += "\n\nPágina atual:\n- Título: " + (page.title || "(sem título)");
    sys += "\n- URL: " + page.url;
    if (page.description) sys += "\n- Descrição: " + page.description;
    if (page.selection) {
      sys +=
        '\n\nTrecho selecionado pelo usuário na página:\n"""\n' +
        page.selection +
        '\n"""';
    }
    sys +=
      "\n\nConteúdo da página" +
      (page.text && page.text.length > limit ? " (trecho truncado)" : "") +
      ':\n"""\n' +
      text +
      '\n"""';
  }
  return sys;
}

// ---------- envio / streaming ----------
async function sendMessage(raw) {
  if (sending) return;
  const input = $("#input");
  const text = String(raw !== undefined ? raw : input.value).trim();
  if (!text) return;

  const { provider, model } = parseModel(prefs.model);
  const p = PROVIDERS.find((x) => x.id === provider);
  const meta = getModelMeta();

  // Captura snapshot de imagens antes do ramo web
  let image = "";
  if (prefs.includeVision && meta.vision) {
    image = await captureThumb();
    if (!image) {
      try {
        const shot = await chrome.runtime.sendMessage({ type: "get-screenshot" });
        if (shot && shot.ok && shot.dataUrl) image = shot.dataUrl;
        else console.warn("[Leitor IA] get-screenshot falhou:", shot && shot.error);
      } catch (e) {
        console.warn("[Leitor IA] erro no get-screenshot:", e);
      }
    }
  }

  // Web grátis, SEM redirecionar: uma aba oculta no site do provedor
  // (login com Google uma única vez) digita a pergunta e devolve a
  // resposta para este painel.
  if (((prefs.oauthMode || {})[provider] || "web") === "web") {
    const limit = prefs.charLimit || 20000;
    let payload = text;
    if (prefs.includePage && page) {
      payload +=
        "\n\n---\nPágina que estou vendo agora:\n- Título: " +
        (page.title || "(sem título)") +
        "\n- URL: " +
        page.url;
      if (page.selection) payload += '\n\nTrecho selecionado:\n"""' + page.selection + '"""';
      if (page.text) {
        payload += '\n\nConteúdo da página:\n"""' + String(page.text).slice(0, limit) + '"""';
      }
    }
    if (prefs.includeVision && image && image.length > 100) {
      payload += "\n\n[Visão — Screenshot da aba atual: " + image.slice(0, 100) + "...]";
    }
    hideBanner();
    input.value = "";
    autosize();
    messages.push({ role: "user", content: text });
    renderChat();
    webHolder = addAssistantPlaceholder();
    webAcc = "";
    currentReqId = newReqId();
    openKeepAlive(); // SW não suspende no meio da resposta
    try {
      sessionStorage.setItem("leitor-ia-webreq", currentReqId);
    } catch (_) {}
    setSending(true);
    let res = null;
    try {
      res = await chrome.runtime.sendMessage({
        type: "web-ask",
        provider,
        text: payload,
        reqId: currentReqId,
        model: prefs.model,
        images: ((image && image.length > 100) ? [image] : [])
      });
    } catch (_) {}
    if (!extAlive()) {
      deadBanner();
      finishStream(webHolder, "", "Painel desconectado — clique em “Reativar painel”.", false);
      setSending(false);
      webHolder = null;
      clearWebSession();
      return;
    }
    if (!res || !res.ok) {
      setSending(false);
      if (res && res.needLogin) {
        // Barreira de login/Cloudflare: botão dedicado, sem redirecionar sozinho
        showBanner(
          "O " +
            (p ? p.name : provider) +
            " pediu login/verificação na aba oculta. Entre com sua conta Google e reenvie a pergunta.",
          "Fazer login no provedor",
          () => {
            chrome.runtime.sendMessage({ type: "web-login", tabId: res.tabId }).catch(() => {});
          }
        );
        finishStream(
          webHolder,
          "",
          "Aguardando login no " + (p ? p.name : provider) + " — depois é só reenviar.",
          false
        );
      } else {
        finishStream(
          webHolder,
          "",
          (res && res.error) || "Não consegui usar a web grátis do " + (p ? p.name : provider) + ".",
          false
        );
      }
      webHolder = null;
      clearWebSession();
      return;
    }
    // deltas/done chegam pelo onMessage (filtrados por reqId); segurança ~3 min
    const rid = currentReqId;
    setTimeout(() => {
      if (sending && webHolder && currentReqId === rid) {
        finishStream(webHolder, webAcc, "O site demorou demais para responder.", false);
        webHolder = null;
        clearWebSession();
        setSending(false);
      }
    }, 180000);
    return;
  }

  // OAuth (conta do provedor, tier gratuito) ou chave de API
  let apiKey = keys[provider] || "";
  let accessToken = "";
  
  // Substituição para modelo customizado com chave própria (ex: OpenRouter, 9Route)
  const customConf = customModels.find((c) => c.provider === provider && c.id === model);
  if (customConf && customConf.apiKey) {
    apiKey = customConf.apiKey;
    accessToken = ""; // Força uso da chave própria
  } else if ((prefs.oauthMode || {})[provider] === "oauth") {
    const t = (oauth.tokens || {})[provider];
    if (t && t.accessToken && Date.now() < (t.expiresAt || 0)) {
      accessToken = t.accessToken;
      apiKey = "";
    } else {
      showBanner(
        "Sessão OAuth de " +
          (p ? p.name : provider) +
          " ausente ou expirada — conecte sua conta nos Ajustes.",
        "Abrir ajustes",
        openSettings
      );
      return;
    }
  } else if (!apiKey) {
    showBanner(
      "Adicione sua chave de API do " + (p ? p.name : provider) + " para usar este modelo.",
      "Abrir ajustes",
      openSettings
    );
    return;
  }
  hideBanner();

  input.value = "";
  autosize();
  // Visão multimodal: o print já foi capturado no topo de sendMessage.
  if (prefs.includeVision && meta.vision && !image) {
    showBanner(
      "Falha ao capturar a tela (o Chrome bloqueia páginas internas e a Nova Aba). Enviando só o texto.",
      null
    );
  }
  messages.push({ role: "user", content: text, image: image });
  renderChat();
  const holder = addAssistantPlaceholder();

  setSending(true);
  const history = messages.slice(-16).map((m) => ({ role: m.role, content: m.content }));
  const req = {
    provider: provider,
    model: model,
    apiKey: apiKey,
    accessToken: accessToken,
    baseUrl: resolveBaseUrl(provider),
    effort: prefs.effort,
    modelSupportsEffort: !!meta.effort,
    modelAdaptive: !!meta.adaptive,
    image: image,
    messages: [{ role: "system", content: buildSystemPrompt() }].concat(history)
  };

  let acc = "";
  try {
    port = chrome.runtime.connect({ name: "chat" });
  } catch (_) {
    if (!extAlive()) {
      deadBanner();
      finishStream(holder, "", "Painel desconectado — clique em “Reativar painel”.", false);
    } else {
      finishStream(holder, "", "Não conectei ao serviço da extensão. Tente de novo.", false);
    }
    return;
  }
  port.onMessage.addListener((m) => {
    if (m.type === "delta") {
      acc += m.text;
      streamInto(holder, acc);
    } else if (m.type === "status") {
      // "Pensando…" durante blocos de thinking (antes do 1º texto)
      if (!acc) streamInto(holder, "_" + m.text + "_");
    } else if (m.type === "error") {
      finishStream(holder, acc, m.message, false);
    } else if (m.type === "done") {
      finishStream(holder, acc, null, !!m.aborted);
    }
  });
  port.onDisconnect.addListener(() => {
    if (sending) finishStream(holder, acc, "Conexão com a extensão encerrada.", false);
  });
  port.postMessage({ type: "start", req: req });
}

function setSending(v) {
  sending = v;
  const btn = $("#btn-send");
  btn.classList.toggle("sending", v);
  btn.title = v ? "Parar" : "Enviar";
  btn.innerHTML = v
    ? '<svg viewBox="0 0 24 24" width="13" height="13"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>';
}

function streamInto(holder, acc) {
  if (!holder.querySelector(".md")) holder.innerHTML = '<div class="md"></div>';
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const el = holder.querySelector(".md");
    if (el) el.innerHTML = renderMarkdown(acc);
    maybeScroll();
  });
}

function finishStream(holder, acc, error, aborted) {
  if (!sending) return;
  setSending(false);
  port = null;
  if (error) {
    holder.innerHTML = '<div class="msg-error">⚠ ' + escapeHtml(error) + "</div>";
  } else if (acc.trim()) {
    messages.push({ role: "assistant", content: acc });
    holder.innerHTML = '<div class="md">' + renderMarkdown(acc) + "</div>";
  } else {
    holder.innerHTML =
      '<div class="msg-empty">' +
      (aborted ? "Resposta interrompida." : "O modelo não retornou texto.") +
      "</div>";
  }
  persist();
  scrollBottom();
}

// ---------- renderização do chat ----------
function renderChat() {
  const chat = $("#chat");
  chat.innerHTML = "";
  if (!messages.length) {
    chat.appendChild(buildEmptyState());
    return;
  }
  for (const m of messages) chat.appendChild(messageEl(m));
  scrollBottom(true);
}

function messageEl(m) {
  const role = m.role;
  const content = m.content;
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (role === "user") {
    // miniatura do print anexado (visão multimodal)
    if (m.image && /^data:image\//.test(m.image)) {
      const img = document.createElement("img");
      img.className = "msg-shot";
      img.alt = "print da página";
      img.src = m.image;
      div.appendChild(img);
    }
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content;
    div.appendChild(bubble);
  } else {
    const md = document.createElement("div");
    md.className = "md";
    md.innerHTML = renderMarkdown(content);
    div.appendChild(md);
  }
  return div;
}

function addAssistantPlaceholder() {
  const chat = $("#chat");
  const holder = document.createElement("div");
  holder.className = "msg assistant streaming";
  holder.innerHTML =
    '<div class="typing"><span></span><span></span><span></span></div>';
  chat.appendChild(holder);
  scrollBottom();
  return holder;
}

function buildEmptyState() {
  const wrap = document.createElement("div");
  wrap.className = "empty";
  const h = document.createElement("h1");
  h.textContent = "Como posso ajudar com esta página?";
  const sub = document.createElement("p");
  sub.textContent = page
    ? "Estou lendo “" + (page.title || page.url) + "”. Pergunte qualquer coisa."
    : "Abra uma página e eu leio o conteúdo para você.";
  wrap.appendChild(h);
  wrap.appendChild(sub);
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const s of SUGGESTIONS) {
    const b = document.createElement("button");
    b.textContent = s;
    b.addEventListener("click", () => sendMessage(s));
    chips.appendChild(b);
  }
  wrap.appendChild(chips);
  return wrap;
}

function scrollBottom(force) {
  const chat = $("#chat");
  const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
  if (force || nearBottom) chat.scrollTop = chat.scrollHeight;
}

function maybeScroll() {
  scrollBottom(false);
}

// ---------- markdown minimalista ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(src) {
  if (!src) return "";
  let text = String(src).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // --- Plain text pre-processing ---
  // 1) Normalize: collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, "\n\n");
  // 2) Detect numbered lists in plain text and convert to markdown
  text = text.replace(/^(\s*)(\d+[.)])\s+/gm, "$1- ");
  // 3) Detect bullet lists in plain text
  text = text.replace(/^(\s*)[•·]\s+/gm, "$1- ");
  // 4) Detect bold/markdown-like emphasis that wasn't processed
  // (we let the markdown parser handle this later)

  const codeBlocks = [];
  let md = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    codeBlocks.push(code);
    return "\u0000C" + (codeBlocks.length - 1) + "\u0000";
  });
  let html = escapeHtml(md);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:[^)\s]*|#[^)\s]*)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  const lines = html.split("\n");
  const out = [];
  let para = [];
  let listTag = null;
  let items = [];
  const flushPara = () => {
    if (para.length) {
      out.push("<p>" + para.join("<br>") + "</p>");
      para = [];
    }
  };
  const flushList = () => {
    if (listTag) {
      out.push(
        "<" + listTag + ">" + items.map((i) => "<li>" + i + "</li>").join("") +
          "</" + listTag + ">"
      );
      listTag = null;
      items = [];
    }
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const codeM = t.match(/^\u0000C(\d+)\u0000$/);
    if (codeM) {
      flushPara();
      flushList();
      const code = codeBlocks[+codeM[1]] || "";
      out.push("<pre><code>" + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>");
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      const lv = h[1].length + 1;
      out.push("<h" + lv + ">" + h[2] + "</h" + lv + ">");
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flushPara();
      flushList();
      out.push("<hr>");
      continue;
    }
    if (/^&gt;\s?/.test(t)) {
      flushPara();
      flushList();
      out.push("<blockquote>" + t.replace(/^&gt;\s?/, "") + "</blockquote>");
      continue;
    }
    const li = t.match(/^[-*+]\s+(.*)$/) || t.match(/^\d+[.)]\s+(.*)$/);
    if (li) {
      flushPara();
      const tag = /^\d/.test(t) ? "ol" : "ul";
      if (listTag && listTag !== tag) flushList();
      if (!listTag) listTag = tag;
      items.push(li[1]);
      continue;
    }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return out.join("\n");
}

// ---------- banner ----------
function showBanner(text, actionLabel, action) {
  const b = $("#banner");
  b.classList.remove("hidden");
  b.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = text;
  b.appendChild(span);
  if (actionLabel) {
    const btn = document.createElement("button");
    btn.textContent = actionLabel;
    btn.addEventListener("click", action);
    b.appendChild(btn);
  }
  const x = document.createElement("button");
  x.className = "banner-x";
  x.textContent = "✕";
  x.title = "Fechar";
  x.addEventListener("click", hideBanner);
  b.appendChild(x);
}

function hideBanner() {
  const b = $("#banner");
  b.classList.add("hidden");
  b.innerHTML = "";
}

// ---------- ajustes ----------
function openSettings() {
  buildSettingsForm();
  $("#settings-overlay").classList.remove("hidden");
}

function closeSettings() {
  $("#settings-overlay").classList.add("hidden");
}

function buildSettingsForm() {
  renderProviderCards();
  const sel = $("#custom-provider");
  sel.innerHTML = "";
  for (const p of PROVIDERS) sel.appendChild(new Option(p.name, p.id));
  renderCustomList();
  $("#char-limit").value = prefs.charLimit;
  $("#panel-mode").value = prefs.panelMode || "inpage";
}

function addCustomModel() {
  const provider = $("#custom-provider").value;
  const id = $("#custom-model").value.trim();
  const baseUrl = $("#custom-endpoint").value.trim();
  const apiKey = $("#custom-key").value.trim();
  if (!id) return;
  if (!customModels.some((c) => c.provider === provider && c.id === id)) {
    customModels.push({ provider: provider, id: id, baseUrl: baseUrl, apiKey: apiKey });
  } else {
    const c = customModels.find((c) => c.provider === provider && c.id === id);
    c.baseUrl = baseUrl;
    c.apiKey = apiKey;
  }
  $("#custom-model").value = "";
  $("#custom-endpoint").value = "";
  $("#custom-key").value = "";
  renderCustomList();
  buildModelMenu();
  persist();
}

function renderCustomList() {
  const ul = $("#custom-list");
  ul.innerHTML = "";
  customModels.forEach((c, idx) => {
    const p = PROVIDERS.find((x) => x.id === c.provider);
    const li = document.createElement("li");
    let info = "";
    if (c.baseUrl) info += ' <span class="star">↦ ' + escapeHtml(c.baseUrl) + "</span>";
    if (c.apiKey) info += ' <span class="star">🔑 ' + escapeHtml(c.apiKey.slice(0, 4) + "…") + "</span>";
    li.innerHTML =
      "<span>" +
      escapeHtml((p ? p.name : c.provider) + " · " + c.id) +
      info +
      "</span>";
    const rm = document.createElement("button");
    rm.textContent = "remover";
    rm.addEventListener("click", () => {
      customModels.splice(idx, 1);
      renderCustomList();
      buildModelMenu();
      persist();
    });
    li.appendChild(rm);
    ul.appendChild(li);
  });
}

function saveSettings() {
  // chaves/endpoints/client-id já são salvos ao digitar; aqui só o restante
  prefs.charLimit = Math.min(
    80000,
    Math.max(2000, parseInt($("#char-limit").value, 10) || 20000)
  );
  prefs.panelMode = $("#panel-mode").value || "inpage";
  persist();
  closeSettings();
}

// ---------- persistência ----------
async function persist() {
  try {
    await chrome.storage.local.set({
      keys: keys,
      baseUrls: baseUrls,
      customModels: customModels,
      prefs: prefs,
      oauth: oauth,
      chat: { messages: messages.slice(-40) }
    });
  } catch (_) {}
}

// ---------- util ----------
function autosize() {
  const input = $("#input");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}
