// Service worker: conta bloqueios, fecha popups e reverte redirects. (v1.1.0)
// Nota: rules.json já é carregado como static ruleset via manifest.json
// (declarative_net_request.rule_resources), então não é necessário
// recarregá-lo aqui como dynamic rules — evita duplicidade de regras.

const counts = {}; // tabId -> número
const lastGesture = {};   // tabId -> timestamp do último gesto de SAÍDA confiável
const lastGoodUrl = {};   // tabId -> última URL boa dentro do site protegido
const GESTURE_MS = 1500;

// Mantenha isto em sincronia com "matches" em manifest.json > content_scripts.
// (Regex casa ápice e subdomínios: megacine.quest, www., img., viewplayer...)
const PROTECTED = /redecanais\.|megacine\.quest|viewplayer\.online|abyssplayer\.com|abyss\.to|megaembed\.link|bysebuho\.com|embedder\.net|warezcdn\.net|superembeds\.com|superflixapi\.top|voe\.sx/i;

function setBadge(tabId) {
  const n = counts[tabId] || 0;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#e11d48" });
}

const isRealExit = (tabId) => Date.now() - (lastGesture[tabId] || 0) < GESTURE_MS;

function closeIfPopup(newTabId, openerId) {
  // Se o usuário acabou de fazer um gesto de SAÍDA de verdade (clicou num
  // link, Ctrl+clique, "abrir em nova aba" etc.), não fechamos: é uma aba
  // legítima, não um pop-up. (Cliques no Play NÃO geram gesto — ver blocker.js.)
  if (isRealExit(openerId)) return;
  chrome.tabs.get(newTabId, (t) => {
    if (chrome.runtime.lastError || !t) return;
    const url = t.pendingUrl || t.url || "";
    // Se a nova aba não é do mesmo site, é pop-up de anúncio -> fecha
    if (
      url &&
      url !== "about:blank" &&
      !url.startsWith("about:") &&
      !url.startsWith("chrome://") &&
      !url.startsWith("chrome-extension://") &&
      !PROTECTED.test(url)
    ) {
      chrome.tabs.remove(newTabId, () => void chrome.runtime.lastError);
      counts[openerId] = (counts[openerId] || 0) + 1;
      setBadge(openerId);
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "blocked" && sender.tab) {
    const id = sender.tab.id;
    counts[id] = (counts[id] || 0) + 1;
    setBadge(id);
    return;
  }
  if (msg && msg.type === "gesture" && sender.tab) {
    lastGesture[sender.tab.id] = Date.now();
    return;
  }
  if (msg && msg.type === "getCount") {
    // Chamado pelo popup.js, que não tem sender.tab (roda fora de content script)
    const tabId = msg.tabId;
    sendResponse({ count: counts[tabId] || 0 });
    return true; // resposta assíncrona
  }
});

chrome.tabs.onRemoved.addListener((id) => {
  delete counts[id];
  delete lastGesture[id];
  delete lastGoodUrl[id];
  chrome.action.setBadgeText({ tabId: id, text: "" });
});

chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === "loading" && info.url) {
    counts[id] = 0;
    chrome.action.setBadgeText({ tabId: id, text: "" });
  }
});

// Fecha abas/popups abertas automaticamente a partir do site protegido
chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.openerTabId) return;
  chrome.tabs.get(tab.openerTabId, (opener) => {
    if (chrome.runtime.lastError || !opener || !opener.url) return;
    if (!PROTECTED.test(opener.url)) return;

    const url = tab.pendingUrl || tab.url || "";
    if (!url || url === "about:blank") {
      // URL ainda indefinida (popup que resolve depois): tenta de novo com
      // atraso. Melhor esforço — se o SW dormir, só não fecha (como na v1.0).
      const newId = tab.id;
      const openerId = opener.id;
      setTimeout(() => closeIfPopup(newId, openerId), 1500);
      setTimeout(() => closeIfPopup(newId, openerId), 4000);
      return;
    }
    closeIfPopup(tab.id, opener.id);
  });
});

// ---- Camada 2: reverte redirects forçados que escaparem do content script ----
// O Chrome não deixa content scripts blindarem `window.location` (é
// não-configurável), então aqui vigiamos a aba principal: se ela sair do site
// protegido para um domínio externo SEM um gesto de saída recente, voltamos atrás.
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0 && PROTECTED.test(d.url)) lastGoodUrl[d.tabId] = d.url;
});

chrome.webNavigation.onBeforeNavigate.addListener(
  (d) => {
    if (d.frameId !== 0) return;

    const anterior = lastGoodUrl[d.tabId];
    if (!anterior) return;                    // não vínhamos do site protegido
    if (PROTECTED.test(d.url)) return;        // navegação interna: liberada
    if (/^(chrome|about|edge|devtools):/.test(d.url)) return;

    if (isRealExit(d.tabId)) return;          // o usuário realmente quis sair

    // Redirect automático para fora -> desfaz
    chrome.tabs.update(d.tabId, { url: anterior }, () => void chrome.runtime.lastError);
    counts[d.tabId] = (counts[d.tabId] || 0) + 1;
    setBadge(d.tabId);
  },
  { url: [{ schemes: ["http", "https"] }] }
);
